import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

test.describe.serial('Dashboard live local',()=>{
  test('wallet, live agent, lab, evidence export, history and mobile',async({page})=>{
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('/');await expect(page.getByRole('heading',{name:'Quỹ & chính sách',exact:true})).toBeVisible();
    await expect(page.getByText('Anvil đã kết nối')).toBeVisible({timeout:20000});
    await page.getByRole('button',{name:'Dùng ví thử nghiệm Anvil'}).click();
    await expect(page.getByText('Đã kết nối ví thử nghiệm Anvil.')).toBeVisible();
    await page.getByRole('button',{name:'Cấp quyền 24h'}).click();
    await expect(page.getByText('Giao dịch owner đã xác nhận trên chain.')).toBeVisible({timeout:20000});
    await mkdir('.runtime/screenshots',{recursive:true});
    await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'.runtime/screenshots/treasury-desktop.png'});
    const state=await(await page.request.get('/api/treasury')).json();
    if(state.policy.remainingCapUsd==='0'&&BigInt(state.portfolio.positions[2].rawBalance)>0n){
      await page.getByLabel('Mục tiêu USDC trong ví',{exact:true}).fill('100');
      await page.getByLabel('Mục tiêu Token A',{exact:true}).fill('0');
      await page.getByLabel('Mục tiêu Vault cho vay',{exact:true}).fill('0');
    }
    await page.getByRole('button',{name:'Xem kế hoạch'}).click();
    await expect(page.getByRole('heading',{name:'Kế hoạch dự kiến'})).toBeVisible();
    await page.getByRole('button',{name:'Chạy agent',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Tái cân bằng danh mục',exact:true})).toBeVisible();
    await expect(page.locator('.verdict-banner.pass')).toBeVisible({timeout:30000});
    await page.getByRole('link',{name:'Phòng kiểm thử',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Phòng kiểm thử',exact:true})).toBeVisible();
    await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'.runtime/screenshots/lab-desktop.png'});
    const card=page.locator('article').filter({has:page.getByRole('heading',{name:'Recipient là ví lạ'})});
    await card.getByRole('button',{name:'Chạy riêng'}).click();
    await expect(page.locator('.verdict-banner.pass')).toBeVisible({timeout:30000});
    await expect(page.getByRole('cell',{name:'ERR_INVALID_RECIPIENT',exact:true})).toBeVisible();
    await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'.runtime/screenshots/result-desktop.png'});
    const download=page.waitForEvent('download');await page.getByRole('link',{name:'Tải CSV'}).click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
    await page.reload();await expect(page.locator('.verdict-banner.pass')).toBeVisible();
    await page.getByRole('link',{name:'Kết quả & lịch sử'}).click();
    await expect(page.getByRole('heading',{name:'Lịch sử lượt chạy'})).toBeVisible();
    await expect(page.locator('.run-link').first()).toBeVisible();
    await page.setViewportSize({width:390,height:844});await page.getByRole('link',{name:'Quỹ & chính sách',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Quỹ & chính sách',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({path:'.runtime/screenshots/treasury-mobile.png',fullPage:true});
    expect(errors).toEqual([]);
  });
  test('wrong network and cancelled signature release no money',async({page})=>{
    const env=await (await page.request.get('/api/environment')).json();
    await page.addInitScript(({owner})=>{window.ethereum={request:async({method}:{method:string})=>{
      if(method==='eth_requestAccounts')return[owner];if(method==='eth_chainId')return'0x1';throw {code:4001,message:'User rejected'};
    }} as never;},{owner:env.owner});
    await page.goto('/');await page.getByRole('button',{name:'Kết nối ví',exact:true}).click();
    await expect(page.getByText('Ví đang sai mạng.',{exact:false})).toBeVisible();
    await page.evaluate(({owner})=>{window.ethereum={request:async({method}:{method:string})=>{
      if(method==='eth_requestAccounts')return[owner];if(method==='eth_chainId')return'0x7a69';throw {code:4001,message:'User rejected'};
    }} as never;},{owner:env.owner});
    await page.getByRole('button',{name:'Kết nối ví',exact:true}).click();
    await expect(page.getByText('Đã kết nối ví owner.')).toBeVisible();
    await page.getByRole('button',{name:'Cấp quyền 24h'}).click();
    await expect(page.getByText('Bạn đã hủy ký; chưa thực hiện thay đổi.')).toBeVisible({timeout:20000});
    const after=await (await page.request.get('/api/environment')).json();expect(after.busy).toBeUndefined();
  });
});
